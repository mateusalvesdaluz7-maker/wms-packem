const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../bob-lot-core.js');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('agrupa bobinas por lote, sem inventar lote para linhas incompletas',()=>{
  const result=core.group([
    {et:'T10000001',pr:'0303490078',pl:18.7,lote:'78.09'},
    {et:'T10000002',pr:'0303490078',pl:20,lote:'78.09'},
    {et:'T10000003',pr:'0303490078',pl:21,lote:'111.10'},
    {et:'T10000004',pr:'0303490078',pl:22,lote:''},
  ]);
  assert.deepEqual(result.groups.map(g=>[g.lote,g.rows.length]),[['78.09',2],['111.10',1]]);
  assert.equal(result.missingLot,1);
  assert.equal(result.conflicts.length,0);
  assert.equal(core.idForLot('78.09'),core.idForLot('78.09'));
});

test('ignora PACKEM S/A como lote e recupera somente a última importação com lote real',()=>{
  assert.equal(core.lot('PACKEMS/A'),'');
  const batch=core.latestBatch({
    T1:{pr:'0303490078',pl:10,lote:'78.09/26',apAt:'2026-10-05T10:00:00Z'},
    T2:{pr:'0303490078',pl:11,lote:'PACKEMS/A',apAt:'2026-10-06T10:00:00Z'},
    T3:{pr:'0303490078',pl:12,lote:'117.10/26',apAt:'2026-10-06T10:00:00Z'},
    T4:{pr:'0303490078',pl:13,lote:'117.10/26',apAt:'2026-10-06T10:00:00Z'},
  });
  assert.equal(batch.rows.length,2);
  assert.equal(batch.groups,1);
  assert.equal(batch.rows[0].lote,'117.10/26');
});

test('reimportação preserva separação e só acrescenta bobinas novas',()=>{
  const old={num:'1',etiqueta:'T10000001',codigo:'0303490078',lote:'78.09',status:'conferido'};
  const result=core.appendItems([old],[
    {et:'T10000001',pr:'0303490078',pl:18.7,lote:'78.09'},
    {et:'T10000002',pr:'0303490078',pl:20,lote:'78.09'},
  ]);
  assert.equal(result.added,1);
  assert.equal(result.items[0],old);
  assert.equal(result.items[1].etiqueta,'T10000002');
  assert.equal(result.items[1].lote,'78.09');
  assert.equal(result.items[1].status,'pendente');
});

test('etiqueta repetida com lote conflitante é identificada',()=>{
  const result=core.group([
    {et:'T10000001',pr:'0303490078',lote:'78.09'},
    {et:'T10000001',pr:'0303490078',lote:'111.10'},
  ]);
  assert.deepEqual(result.conflicts,['T10000001']);
});

test('lote abreviado não é tratado como OP; somente número de OP igual permite vínculo',()=>{
  const record={meta:{loteMain:'117.10/26',source:'cut-op'},items:[{op:'04690601001'},{op:'04690601002'},{op:''}]};
  const rows=[
    {et:'T1',lote:'117.10',op:'04273501001'},
    {et:'T2',lote:'117.10',op:'04690601001'},
    {et:'T3',lote:'117.10',op:''},
  ];
  assert.equal(core.lotStem('117.10'),core.lotStem('117.10/26'));
  assert.deepEqual(core.matchCutOp(rows,record).map(row=>row.et),['T2']);
  assert.equal(core.op('OP: 04690601001'),'04690601001');
});

test('OP importada permanece no catálogo e na linha de expedição',()=>{
  const batch=core.latestBatch({T1:{pr:'0404510249',pl:700,lote:'117.10',op:'04273501001',apAt:'2026-10-06T11:00:00Z'}});
  assert.equal(batch.rows[0].op,'04273501001');
  const item=core.expItem({...batch.rows[0],sourceLote:'117.10',lote:'117.10/26'},1);
  assert.equal(item.op,'04273501001');
  assert.equal(item.lote,'117.10/26');
  assert.equal(item.loteOrigem,'117.10');
});

test('etiquetas apontadas substituem somente o item provisório da mesma OP',()=>{
  const record={meta:{source:'cut-op',loteMain:'117.10/26'},items:[
    {num:'1',op:'04690601004',etiqueta:'',descricao:'SAIA',qtdNum:5000,codigoMateriaPrima:'0303550015',status:'pendente',tags:[]},
    {num:'2',op:'04690601002',etiqueta:'',descricao:'ALÇA',qtdNum:20000,status:'pendente',tags:[]},
    {num:'3',op:'04690601004',etiqueta:'T30384823',descricao:'SAIA 48+12G 97X402CM BRANCO',codigo:'0404570023',qtdNum:1050,origin:'bobinas',status:'conferido'},
    {num:'4',op:'04690601004',etiqueta:'T30384850',descricao:'SAIA 48+12G 97X402CM BRANCO',codigo:'0404570023',qtdNum:2050,origin:'bobinas',status:'pendente'},
    {num:'5',op:'04690601004',etiqueta:'T30384852',descricao:'SAIA 48+12G 97X402CM BRANCO',codigo:'0404570023',qtdNum:2000,origin:'bobinas',status:'pendente'},
    {num:'6',op:'04273501002',etiqueta:'TOLD',qtdNum:100,origin:'bobinas',status:'pendente'}
  ]};
  const result=core.replaceCutPlaceholders(record);
  assert.equal(result.replaced,1);
  assert.deepEqual(result.record.items.map(item=>item.etiqueta),['','T30384823','T30384850','T30384852','TOLD']);
  assert.equal(result.record.items[1].status,'conferido');
  assert.equal(result.record.items[1].codigo,'0404570023');
  assert.equal(result.record.items[1].targetQuantity,5000);
  assert.equal(result.record.meta.productionTargets.length,2);
  assert.equal(record.items.length,6);
});

test('primeiro apontamento substitui a prévia e mostra somente a quantidade produzida',()=>{
  const record={meta:{source:'cut-op',loteMain:'117.10/26',productionTargets:[{num:'1',op:'04690601008',label:'LINER',quantity:5000,materialCode:'0303440027',materialDescription:'FILME PE 198CM'}]},items:[
    {num:'1',op:'04690601008',etiqueta:'',descricao:'LINER',qtdNum:5000,status:'pendente',tags:[]},
    {num:'2',op:'04690601008',etiqueta:'T30384872',codigo:'0404550219',qtdNum:1700,loteOrigem:'117.10',status:'pendente'}
  ]};
  const result=core.replaceCutPlaceholders(record);
  assert.equal(result.replaced,1);
  assert.equal(result.record.items.length,1);
  assert.equal(result.record.items[0].qtdNum,1700);
  assert.equal(result.record.items[0].targetQuantity,5000);
});

test('item provisório com separação iniciada não é removido pelo relatório',()=>{
  const record={meta:{source:'cut-op'},items:[
    {num:'1',op:'04690601004',etiqueta:'',qtdNum:5000,feito:100,status:'parcial',tags:[{tag:'T1',q:100}]},
    {num:'2',op:'04690601004',etiqueta:'T2',qtdNum:1000,origin:'bobinas',status:'pendente'}
  ]};
  assert.equal(core.replaceCutPlaceholders(record).replaced,0);
});

test('importação cria romaneio, reimporta sem duplicar e conserva a separação',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('window.EXP.importBobLotes=async function(sourceRows){');
  const end=app.indexOf('/* ===================== BAIXA PROTHEUS',start);
  assert.ok(start>=0&&end>start);
  let saved='';
  const remote={};
  let posts=0;
  const sequence=[];
  const context={
    window:{EXP:{},BobLotCore:core},
    _expBooted:true,
    romaneios:[],
    SUPA_REST:'https://example.test/romaneios',
    supaHeaders:()=>({}),
    fetch:async (_url,options)=>{
      if(!options.method)return {ok:true,json:async()=>Object.values(remote).map(r=>({id:r.id,dados:r}))};
      posts++;sequence.push('cloud');
      for(const row of JSON.parse(options.body))remote[row.id]=row.dados;
      return {ok:true};
    },
    statusRank:(status)=>status==='conferido'?2:(status==='separado'?1:0),
    saveStoreLocal:()=>{sequence.push('local');saved=JSON.stringify({romaneios:context.romaneios});},
    localStorage:{getItem:()=>saved},
    STORE_KEY:'test',
    renderLotes:()=>{},
    cacheBobLotes:()=>{},
    setSupaStatus:()=>{},
    supaPush:()=>{},
    session:{u:'admin'},
    Date,JSON,Set,
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start,end),context);
  const a={et:'T10000001',pr:'0303490078',desc:'Tecido',pl:18.7,lote:'78.09'};
  const b={et:'T10000002',pr:'0303490078',desc:'Tecido',pl:20,lote:'78.09'};
  const first=await context.window.EXP.importBobLotes([a]);
  assert.equal(first.added,1);
  assert.equal(posts,1);
  assert.deepEqual(sequence.slice(0,2),['cloud','local']);
  assert.equal(context.romaneios[0].items[0].status,'pendente');
  context.romaneios[0].items[0].status='conferido';
  const repeat=await context.window.EXP.importBobLotes([a,b]);
  assert.equal(repeat.added,1);
  assert.equal(posts,2);
  assert.equal(context.romaneios[0].items.length,2);
  assert.equal(context.romaneios[0].items[0].status,'conferido');
  const again=await context.window.EXP.importBobLotes([a,b]);
  assert.equal(again.added,0);
  assert.equal(posts,2);
});

test('confirma romaneio na nuvem mesmo sem espaço no armazenamento local',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('window.EXP.importBobLotes=async function(sourceRows){');
  const end=app.indexOf('window.EXP.ensureCutOpRomaneio=async function(draft){',start);
  let posted=0;
  const context={window:{EXP:{},BobLotCore:core},_expBooted:true,romaneios:[],SUPA_REST:'https://example.test/romaneios',
    supaHeaders:()=>({}),fetch:async(_url,options)=>{if(!options.method)return{ok:true,json:async()=>[]};posted++;return{ok:true};},
    saveStoreLocal:()=>{},renderLotes:()=>{},cacheBobLotes:()=>{},setSupaStatus:()=>{},statusRank:()=>0,
    session:{u:'admin'},Date,JSON,Set};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const result=await context.window.EXP.importBobLotes([{et:'T1',pr:'0303490078',pl:18,lote:'78.09/26'}]);
  assert.equal(result.synced,true);
  assert.equal(posted,1);
  assert.equal(context.romaneios[0].items.length,1);
});

test('Excel só acrescenta bobina à ficha de corte quando a OP coincide',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('window.EXP.importBobLotes=async function(sourceRows){');
  const end=app.indexOf('window.EXP.ensureCutOpRomaneio=async function(draft){',start);
  const canonical={id:'EXP-CUT-1',meta:{source:'cut-op',loteMain:'117.10/26'},items:[{num:'1',op:'04690601001',etiqueta:'',qtdNum:700,status:'pendente'}],_upd:1};
  const cloud={[canonical.id]:canonical};
  let posts=0;
  const context={window:{EXP:{},BobLotCore:core},_expBooted:true,romaneios:[canonical],SUPA_REST:'https://example.test/romaneios',
    supaHeaders:()=>({}),fetch:async(url,options)=>{
      if(!options.method)return{ok:true,json:async()=>Object.values(cloud).map(record=>({id:record.id,dados:record}))};
      posts++;JSON.parse(options.body).forEach(row=>{cloud[row.id]=row.dados;});return{ok:true};
    },statusRank:()=>0,saveStoreLocal:()=>{},renderLotes:()=>{},cacheBobLotes:()=>{},setSupaStatus:()=>{},
    session:{u:'admin'},Date,JSON,Set,encodeURIComponent};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const wrong={et:'T1',pr:'0404510249',pl:700,lote:'117.10',op:'04273501001'};
  const rejected=await context.window.EXP.importBobForCutOp([wrong],'117.10/26');
  assert.equal(rejected.matched,0);
  assert.equal(posts,0);
  assert.equal(cloud[canonical.id].items.length,1);
  const right={et:'T2',pr:'0404510249',pl:700,lote:'117.10',op:'04690601001'};
  const accepted=await context.window.EXP.importBobForCutOp([wrong,right],'117.10/26');
  assert.equal(accepted.matched,1);
  assert.equal(accepted.added,1);
  assert.equal(posts,1);
  assert.equal(cloud[canonical.id].items.length,1);
  assert.equal(cloud[canonical.id].items[0].etiqueta,'T2');
  assert.equal(cloud[canonical.id].items[0].loteOrigem,'117.10');
  assert.equal(cloud[canonical.id].meta.productionTargets.length,1);
});

test('relatório misto 117.10 filtra OPs antigas e mantém somente etapas da ficha 117.10/26',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('window.EXP.importBobMatchingCutOps=async function(sourceRows){');
  const end=app.indexOf('window.EXP.consolidateBobLot=async function(lote){',start);
  const record={id:'EXP-CUT-208',meta:{source:'cut-op',loteMain:'117.10/26',sourceOperations:['04690601004','04690601008']},items:[]};
  const selected=[];
  const context={window:{EXP:{importBobForCutOp:async(rows,lote)=>{selected.push({rows,lote});return {lots:1,added:rows.length,skipped:0};}},BobLotCore:core},
    SUPA_REST:'https://example.test/romaneios',supaHeaders:()=>({}),fetch:async()=>({ok:true,json:async()=>[{id:record.id,dados:record}]})};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const rows=[
    {et:'OLD',lote:'117.10',op:'04273501004'},
    {et:'SAIA',lote:'117.10',op:'04690601004'},
    {et:'LINER',lote:'117.10',op:'04690601008'},
  ];
  const result=await context.window.EXP.importBobMatchingCutOps(rows);
  assert.equal(result.matched,2);
  assert.equal(result.unmatched,1);
  assert.equal(result.added,2);
  assert.deepEqual(Array.from(selected[0].rows,row=>row.et),['SAIA','LINER']);
  assert.equal(selected[0].lote,'117.10/26');
});

test('sincronização de lote de bobinas incorpora etiqueta nova da nuvem no cache antigo',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('function mergeRemoteRomaneio(L,R){');
  const end=app.indexOf('function romSig(r){',start);
  const context={mergeItem:(local)=>local};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const local={id:'BOB-LOTE-1',meta:{loteMain:'78.09/26',source:'bobinas'},items:[{num:'1',etiqueta:'T1',status:'conferido'}],_upd:1};
  const remote={...local,items:[{num:'1',etiqueta:'T1',status:'pendente'},{num:'2',etiqueta:'T2',status:'pendente'}],_upd:2};
  const merged=context.mergeRemoteRomaneio(local,remote);
  assert.deepEqual(merged.items.map(item=>item.etiqueta),['T1','T2']);
  assert.equal(merged.items[0].status,'conferido');
  const oldPdf={id:'ROM-ANTIGO',meta:{loteMain:'04.08',source:'pdf'},items:[{num:'1',etiqueta:'T1',status:'conferido'}],_upd:1};
  const updatedPdf={...oldPdf,meta:{...oldPdf.meta,bobinasConsolidadas:true},items:[...oldPdf.items,{num:'2',etiqueta:'T2',status:'pendente'}],_upd:2};
  assert.deepEqual(context.mergeRemoteRomaneio(oldPdf,updatedPdf).items.map(item=>item.etiqueta),['T1','T2']);
});

test('sincronização da OP não ressuscita item provisório substituído por etiqueta',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('function statusRank(s){');
  const end=app.indexOf('function romSig(r){',start);
  const context={window:{BobLotCore:core}};vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const placeholder={num:'1',etiqueta:'',op:'04690601004',qtdNum:5000,status:'pendente',tags:[]};
  const label={num:'2',etiqueta:'T30384823',op:'04690601004',loteOrigem:'117.10',qtdNum:5100,status:'pendente'};
  const local={id:'EXP-CUT-1',meta:{source:'cut-op',productionTargets:[{num:'1',op:'04690601004',label:'SAIA',quantity:5000}]},items:[placeholder,label],_upd:1};
  const remote={...local,items:[label],_upd:2};
  const merged=context.mergeRemoteRomaneio(local,remote);
  assert.deepEqual(merged.items.map(item=>item.etiqueta),['T30384823']);
});

test('bobinas do Excel entram no romaneio existente e o duplicado sai dos pendentes',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('window.EXP.consolidateBobLot=async function(lote){');
  const end=app.indexOf('window.EXP.ensureCutOpRomaneio=async function(draft){',start);
  assert.ok(start>=0&&end>start);
  const canonical={id:'ROM-ANTIGO',meta:{loteMain:'04.08',source:'pdf',destMain:'AGROLANDIA'},items:[{num:'1',etiqueta:'T1',status:'conferido'}],_upd:1};
  const duplicate={id:core.idForLot('04.08'),meta:{loteMain:'04.08',source:'bobinas'},items:[{num:'1',etiqueta:'T2',status:'pendente'}],_upd:2};
  const cloud={[canonical.id]:canonical,[duplicate.id]:duplicate};
  const posts=[];
  const context={window:{EXP:{},BobLotCore:core},_expBooted:true,romaneios:[canonical,duplicate],SUPA_REST:'https://example.test/romaneios',
    supaHeaders:()=>({}),fetch:async(_url,options)=>{
      if(!options.method)return{ok:true,json:async()=>Object.values(cloud).map(record=>({id:record.id,dados:record}))};
      const rows=JSON.parse(options.body);posts.push(rows);
      rows.forEach(row=>{cloud[row.id]=row.dados;});return{ok:true};
    },
    mergeItem:(a,b)=>({...a,status:a.status==='conferido'?'conferido':b.status}),saveStoreLocal:()=>{},renderLotes:()=>{},
    session:{u:'admin'},Date,JSON,Set,encodeURIComponent};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const result=await context.window.EXP.consolidateBobLot('04.08');
  assert.equal(result.merged,1);
  assert.equal(posts.length,2);
  assert.deepEqual(cloud['ROM-ANTIGO'].items.map(item=>item.etiqueta),['T1','T2']);
  assert.equal(cloud['ROM-ANTIGO'].items[0].status,'conferido');
  assert.equal(cloud['ROM-ANTIGO'].meta.destMain,'AGROLANDIA');
  assert.equal(cloud[duplicate.id].cancelado,true);
});

test('localiza romaneio existente na nuvem mesmo sem cache local da Expedição',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('window.EXP.consolidateBobLot=async function(lote){');
  const end=app.indexOf('window.EXP.ensureCutOpRomaneio=async function(draft){',start);
  const canonical={id:'ROM-ANTIGO',meta:{loteMain:'04.08',source:'apontamentos'},items:[{num:'1',etiqueta:'T1',status:'conferido'}],_upd:1};
  const duplicate={id:core.idForLot('04.08'),meta:{loteMain:'04.08',source:'bobinas'},items:[{num:'1',etiqueta:'T2',status:'pendente'}],_upd:2};
  const cloud={[canonical.id]:canonical,[duplicate.id]:duplicate};
  let lotLookup=0;
  const context={window:{EXP:{},BobLotCore:core},_expBooted:true,romaneios:[duplicate],SUPA_REST:'https://example.test/romaneios',
    supaHeaders:()=>({}),fetch:async(url,options)=>{
      if(!options.method){if(url.includes('loteMain'))lotLookup++;return{ok:true,json:async()=>Object.values(cloud).map(record=>({id:record.id,dados:record}))};}
      JSON.parse(options.body).forEach(row=>{cloud[row.id]=row.dados;});return{ok:true};
    },mergeItem:(a,b)=>({...a,status:a.status==='conferido'?'conferido':b.status}),saveStoreLocal:()=>{},renderLotes:()=>{},
    session:{u:'admin'},Date,JSON,Set,encodeURIComponent};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const result=await context.window.EXP.consolidateBobLot('04.08');
  assert.equal(lotLookup,1);
  assert.equal(result.merged,1);
  assert.equal(cloud['ROM-ANTIGO'].items.length,2);
});

test('nova bobina de lote consolidado entra no romaneio original sem reabrir duplicado',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('window.EXP.importBobLotes=async function(sourceRows){');
  const end=app.indexOf('window.EXP.ensureCutOpRomaneio=async function(draft){',start);
  const original={id:'ROM-ANTIGO',meta:{loteMain:'04.08',source:'apontamentos',bobinasConsolidadas:true},items:[{num:'1',etiqueta:'T1',status:'conferido'}],_upd:1};
  const duplicate={id:core.idForLot('04.08'),meta:{loteMain:'04.08',source:'bobinas'},items:[{num:'1',etiqueta:'T2'}],cancelado:true,_upd:2};
  const cloud={[original.id]:original,[duplicate.id]:duplicate};
  const context={window:{EXP:{},BobLotCore:core},_expBooted:true,romaneios:[original,duplicate],SUPA_REST:'https://example.test/romaneios',
    supaHeaders:()=>({}),fetch:async(_url,options)=>{
      if(!options.method)return{ok:true,json:async()=>Object.values(cloud).map(record=>({id:record.id,dados:record}))};
      JSON.parse(options.body).forEach(row=>{cloud[row.id]=row.dados;});return{ok:true};
    },statusRank:()=>0,saveStoreLocal:()=>{},renderLotes:()=>{},cacheBobLotes:()=>{},setSupaStatus:()=>{},
    session:{u:'admin'},Date,JSON,Set,encodeURIComponent};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const result=await context.window.EXP.importBobLotes([{et:'T3',pr:'0303490078',pl:20,lote:'04.08'}]);
  assert.equal(result.added,1);
  assert.deepEqual(cloud['ROM-ANTIGO'].items.map(item=>item.etiqueta),['T1','T3']);
  assert.equal(cloud[duplicate.id].cancelado,true);
});
