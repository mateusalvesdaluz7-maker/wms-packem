const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const auto=require('../cut-auto-core.js');

const catalog=[{code:'0303480120',description:'TEC.TUBULAR PP LAM.48G+12G 65CM BRANCO'}];
const draft=[{op:'04681501005',label:'VÁLVULA FUNDO',description:'TBL 48 + 12 G X 65 CM BR',code:'0303480120',quantity:4.914,unit:'KG',formula:'0,75 × 0,65 × 60/1000 × 50'}];
const compatible=()=>({score:10});

test('requisição usa consumo de corte e romaneio usa peças da OP',()=>{
  const checked=auto.validate(draft,catalog,'PP',compatible);
  assert.equal(checked.ok,true);
  const op={id:'OP-WMS-ABC',ap:'1184',lot:'78.09.26',client:'CARGILL',quantity:50};
  const now='2026-10-06T12:00:00.000Z';
  const req=auto.request(op,checked.lines,'admin',now);
  const exp=auto.romaneio(op,checked.lines,'admin',now);
  assert.equal(req.source_cut_op_id,op.id);
  assert.equal(req.status,'pendente');
  assert.equal(req.selecao_corte_requerida,true);
  assert.equal(req.liberada_logistica,false);
  assert.equal(req.itens[0].maquina,'');
  assert.equal(exp.meta.sourceCutOpId,op.id);
  assert.equal(req.itens[0].codigo,exp.items[0].codigoMateriaPrima);
  assert.equal(req.itens[0].quantidade,5);
  assert.equal(exp.items[0].qtdNum,50);
  assert.equal(exp.items[0].unidade,'UN');
  assert.equal(exp.items[0].codigo,'');
  assert.equal(req.itens[0].op,exp.items[0].op);
  assert.equal(exp.items[0].lote,op.lot);
  assert.equal(exp.items[0].etiqueta,'');
  assert.equal(exp.items[0].status,'pendente');
  assert.equal(req.id,auto.request(op,checked.lines,'admin',now).id);
  assert.equal(exp.id,auto.romaneio(op,checked.lines,'admin',now).id);
});

test('corte define máquina e prioridade por material antes de liberar a logística',()=>{
  const op={id:'OP-CORTE',ap:'208',lot:'117.10/26',quantity:5000};
  const lines=[{...draft[0],label:'VÁLVULA FUNDO'},{...draft[0],label:'TOPO'}];
  const prepared=auto.request(op,lines,'PCP','2026-10-07T12:00:00.000Z');
  const released=auto.releaseRequest(prepared,[{selected:true,maquina:'CT12 - VALVULAS',prioridade:'urgente'},{selected:false}],'corte','2026-10-07T12:30:00.000Z');
  assert.equal(prepared.status,'pendente');
  assert.equal(prepared.itens[0].maquina,'');
  assert.equal(released.status,'pendente');
  assert.equal(released.liberada_logistica,true);
  assert.equal(released.prioridade,'urgente');
  assert.deepEqual(released.itens.map(item=>item.maquina),['CT12 - VALVULAS','']);
  assert.deepEqual(released.itens.map(item=>item.liberado_logistica),[true,false]);
  assert.deepEqual(released.itens.map(item=>item.prioridade_logistica),['urgente','normal']);
  assert.equal(released.itens[0].urgencia_solicitada_em,'2026-10-07T12:30:00.000Z');
  assert.deepEqual(released.itens.map(item=>item.quantidade),prepared.itens.map(item=>item.quantidade));
  assert.throws(()=>auto.releaseRequest(prepared,[{selected:true,maquina:'',prioridade:'normal'},{selected:false}],'corte','2026-10-07T12:30:00.000Z'),/máquina/);
  assert.throws(()=>auto.releaseRequest(prepared,[{selected:false},{selected:false}],'corte','2026-10-07T12:30:00.000Z'),/pelo menos um/);
  const ongoing={...released,status:'em_separacao',itens:released.itens.map((item,index)=>index?item:{...item,quantidade_separada:2})};
  const later=auto.releaseRequest(ongoing,[{selected:true,maquina:'CT12 - VALVULAS',prioridade:'urgente'},{selected:true,maquina:'CT17 - FUNDO',prioridade:'normal'}],'corte','2026-10-07T13:00:00.000Z');
  assert.equal(later.status,'em_separacao');
  assert.equal(later.itens[0].quantidade_separada,2);
  assert.equal(later.itens[1].liberado_logistica,true);
  assert.equal(later.itens[0].urgencia_solicitada_em,'2026-10-07T12:30:00.000Z');
});

test('urgência mantém a hora do primeiro pedido após nova máquina e sincronização',()=>{
  const op={id:'OP-FILA',ap:'208',lot:'117.10/26',quantity:50};
  const prepared=auto.request(op,[{...draft[0],label:'FUNDO'}],'PCP','2026-10-07T12:00:00.000Z');
  const first=auto.releaseRequest(prepared,[{selected:true,maquina:'CT15 - FUNDO',prioridade:'urgente'}],'corte','2026-10-07T12:30:00.000Z');
  const next=auto.releaseRequest(first,[{selected:true,maquina:'CT17 - FUNDO',prioridade:'urgente',urgencia_solicitada_em:first.itens[0].urgencia_solicitada_em}],'corte','2026-10-07T13:00:00.000Z');
  assert.equal(next.itens[0].urgencia_solicitada_em,'2026-10-07T12:30:00.000Z');
  assert.equal(next.itens[0].maquina,'CT17 - FUNDO');
});

test('nova urgência preserva destino e quantidade de item que já começou a ser separado',()=>{
  const op={id:'OP-ITEM-URGENTE',ap:'208',lot:'117.10/26',quantity:50};
  const lines=[{...draft[0],label:'VÁLVULA FUNDO'},{...draft[0],label:'ALÇA'}];
  const prepared=auto.request(op,lines,'PCP','2026-10-07T12:00:00.000Z');
  const active={...prepared,status:'em_separacao',itens:[{...prepared.itens[0],maquina:'CT20 - VALVULAS',prioridade_logistica:'normal',quantidade_separada:2},prepared.itens[1]]};
  const result=auto.releaseRequest(active,[{selected:true,maquina:'CT11 - VALVULAS',prioridade:'urgente'},{selected:true,maquina:'CT09 - ALÇA',prioridade:'urgente'}],'corte','2026-10-07T13:00:00.000Z');
  assert.equal(result.itens[0].maquina,'CT20 - VALVULAS');
  assert.equal(result.itens[0].quantidade_separada,2);
  assert.equal(result.itens[1].maquina,'CT09 - ALÇA');
  assert.equal(result.itens[1].prioridade_logistica,'urgente');
});

test('aviso urgente mostra somente o material escolhido e sua prioridade',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('  function alertaItens(r){');
  const end=app.indexOf('  function codigo(i){',start);
  assert.ok(start>=0&&end>start);
  const context={itens:r=>r.itens};
  vm.createContext(context);
  vm.runInContext(app.slice(start,end)+'\nthis.getAlertItems=alertaItens;this.getAlertPriority=alertaPrioridade;',context);
  const request={prioridade:'normal',itens:[{id:'A',maquina:'CT20 - VALVULAS',prioridade_logistica:'normal'},{id:'B',maquina:'CT09 - ALÇA',prioridade_logistica:'urgente'}],alerta_logistica:{item_id:'B'}};
  assert.equal(context.getAlertItems(request).map(item=>item.id).join(','),'B');
  assert.equal(context.getAlertPriority(request),'urgente');
});

test('fila e itens da OP seguem a hora do primeiro pedido de urgência',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const helpers=app.slice(app.indexOf('  function itemUrgente(i){'),app.indexOf('  function alertaItens(r){'));
  const listing=app.slice(app.indexOf('  function criadoEm(r){'),app.indexOf('  function progresso(r){'));
  const requests=[
    {id:'normal',status:'pendente',created_date:'2026-10-07T09:00:00.000Z',itens:[]},
    {id:'tarde',status:'pendente',created_date:'2026-10-07T10:00:00.000Z',itens:[
      {id:'B1',prioridade_logistica:'urgente',urgencia_solicitada_em:'2026-10-07T13:00:00.000Z'},
      {id:'B2',prioridade_logistica:'urgente',urgencia_solicitada_em:'2026-10-07T12:30:00.000Z'},
      {id:'B3',prioridade_logistica:'normal'}
    ]},
    {id:'primeiro',status:'pendente',created_date:'2026-10-07T11:00:00.000Z',itens:[{id:'C1',prioridade_logistica:'urgente',urgencia_solicitada_em:'2026-10-07T12:15:00.000Z'}]}
  ];
  const context={REQS:requests,state:{busca:'',status:'pendente',prioridade:'todas'},normStatus:r=>r.status,todosItens:r=>r.itens,itens:r=>r.itens,codigo:i=>i.codigo||'',descricao:i=>i.material||'',maquina:i=>i.maquina||''};
  vm.createContext(context);
  vm.runInContext(helpers+listing+'\nthis.orderRequests=filtrar;this.orderItems=itensOrdenados;',context);
  assert.deepEqual(Array.from(context.orderRequests(),r=>r.id),['primeiro','tarde','normal']);
  assert.deepEqual(Array.from(context.orderItems(requests[1]),i=>i.id),['B2','B1','B3']);
});

test('liberação envia a requisição configurada à nuvem antes de abrir para logística',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-requisicao.js'),'utf8');
  const start=app.indexOf('window.wmsReleaseCutRequest=async function(id,choices,user){');
  const end=app.indexOf('async function reqPull(){',start);
  assert.ok(start>=0&&end>start);
  const staged=auto.request({id:'OP-CLOUD',ap:'208',lot:'117.10/26',quantity:50},[{...draft[0],label:'VÁLVULA FUNDO'}],'PCP','2026-10-07T12:00:00.000Z');
  let saved=null,persisted=false;
  const context={window:{CutAutoCore:auto},REQS:[staged],REQ_SUPA_URL:'https://example.test/req',reqHeaders:()=>({}),reqStamp:r=>Date.parse(r.updated_date),reqPersist:()=>{persisted=true;},reqLocalSig:()=>'',reqLastLocalSig:'',encodeURIComponent,Date,
    fetch:async(_url,options)=>options.method?((saved=JSON.parse(options.body)[0].dados),{ok:true}):{ok:true,json:async()=>[{dados:staged}]}};
  context.cutFetch=context.fetch;
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const result=await context.window.wmsReleaseCutRequest(staged.id,[{selected:true,maquina:'CT12 - VALVULAS',prioridade:'critico'}],'corte');
  assert.equal(saved.status,'pendente');
  assert.equal(saved.itens[0].maquina,'CT12 - VALVULAS');
  assert.equal(saved.prioridade,'critico');
  assert.equal(result.id,context.REQS[0].id);
  assert.equal(persisted,true);
});

test('escolha de máquina altera só o item marcado quando a requisição remota mudou',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-requisicao.js'),'utf8');
  const syncStart=app.indexOf('var cutSyncTimers=new Map()');
  const syncEnd=app.indexOf('async function reqPushNow(){',syncStart);
  const start=app.indexOf('window.wmsReleaseCutRequest=async function(id,choices,user){');
  const end=app.indexOf('async function reqPull(){',start);
  const local=auto.request({id:'OP-ORDEM',ap:'208',lot:'117.10/26',quantity:50},[{...draft[0],label:'FUNDO'},{...draft[0],label:'TOPO'}],'PCP','2026-10-07T12:00:00.000Z');
  const remote={...local,updated_date:'2026-10-07T12:10:00.000Z',itens:[{...local.itens[1],maquina:'CT09 - ALÇA',liberado_logistica:true},local.itens[0]]};
  let saved;
  const context={window:{CutAutoCore:auto},REQS:[local],REQ_SUPA_URL:'https://example.test/req',reqHeaders:()=>({}),reqStamp:r=>Date.parse(r.updated_date),reqPersist:()=>{},reqLocalSig:()=>'',reqLastLocalSig:'',encodeURIComponent,Date,setTimeout,clearTimeout,console,
    fetch:async(_url,options)=>options.method?((saved=JSON.parse(options.body)[0].dados),{ok:true}):{ok:true,json:async()=>[{dados:remote}]}};
  vm.createContext(context);vm.runInContext(app.slice(syncStart,syncEnd)+app.slice(start,end),context);
  await context.window.wmsReleaseCutRequest(local.id,[{id:local.itens[0].id,target:true,selected:true,maquina:'CT12 - VALVULAS',prioridade:'urgente'},{id:local.itens[1].id,target:false,selected:false,maquina:'CT15 - FUNDO',prioridade:'normal'}],'corte');
  assert.equal(saved,undefined);
  assert.equal(context.REQS[0].itens[0].maquina,'CT12 - VALVULAS');
  assert.equal(context.REQS[0]._cut_sync_state,'pending');
  await context.window.wmsCutSyncNow(local.id);
  assert.deepEqual(saved.itens.map(i=>i.maquina),['CT09 - ALÇA','CT12 - VALVULAS']);
  assert.deepEqual(saved.itens.map(i=>i.prioridade_logistica),['normal','urgente']);
  assert.equal(saved.itens[1].urgencia_solicitada_em,context.REQS[0].itens[1].urgencia_solicitada_em);
  assert.equal(context.REQS[0]._cut_sync_patch,undefined);
});

test('falha de rede mantém escolha local e oferece nova tentativa',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-requisicao.js'),'utf8');
  const syncStart=app.indexOf('var cutSyncTimers=new Map()');
  const syncEnd=app.indexOf('async function reqPushNow(){',syncStart);
  const releaseStart=app.indexOf('window.wmsReleaseCutRequest=async function(id,choices,user){');
  const releaseEnd=app.indexOf('async function reqPull(){',releaseStart);
  const request=auto.request({id:'OP-OFFLINE',ap:'208',lot:'117.10/26',quantity:50},[{...draft[0],label:'VÁLVULA FUNDO'}],'PCP','2026-10-07T12:00:00.000Z');
  let online=false,posted=null,persisted=null;
  const context={window:{CutAutoCore:auto},REQS:[request],REQ_SUPA_URL:'https://example.test/req',reqHeaders:()=>({}),reqStamp:r=>Date.parse(r.updated_date),reqPersist:()=>{persisted=JSON.stringify(context.REQS);},reqLocalSig:()=>'',reqLastLocalSig:'',encodeURIComponent,Date,setTimeout,clearTimeout,console:{warn:()=>{}},
    fetch:async(_url,options)=>{if(!online)throw new Error('offline');if(options.method){posted=JSON.parse(options.body)[0].dados;return{ok:true};}return{ok:true,json:async()=>[{dados:request}]};}};
  vm.createContext(context);vm.runInContext(app.slice(syncStart,syncEnd)+app.slice(releaseStart,releaseEnd),context);
  await context.window.wmsReleaseCutRequest(request.id,[{id:request.itens[0].id,target:true,selected:true,maquina:'CT12 - VALVULAS',prioridade:'urgente'}],'corte');
  assert.match(persisted,/CT12 - VALVULAS/);
  for(let i=0;i<3;i++)await context.window.wmsCutSyncNow(request.id);
  assert.equal(context.REQS[0]._cut_sync_state,'error');
  assert.equal(context.REQS[0].itens[0].maquina,'CT12 - VALVULAS');
  online=true;
  assert.equal(context.window.wmsRetryCutSync(request.id),true);
  await context.window.wmsCutSyncNow(request.id);
  assert.equal(posted.itens[0].maquina,'CT12 - VALVULAS');
  assert.equal(context.REQS[0]._cut_sync_patch,undefined);
});

test('arquivo original da OP pode ser reaberto em outro navegador',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-corte.js'),'utf8');
  const start=app.indexOf('async function encodeOpFile(file){');
  const end=app.indexOf('async function ensureCutWorkflow(record,lines){',start);
  assert.ok(start>=0&&end>start);
  const context={File,Uint8Array,btoa,atob,Error};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const original=new File([Uint8Array.from([37,80,68,70,0,255,13,10])],'OP original.pdf',{type:'application/pdf'});
  const encoded=await context.encodeOpFile(original);
  const restored=context.decodeOpFile(encoded);
  assert.equal(restored.name,original.name);
  assert.equal(restored.type,'application/pdf');
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()),Buffer.from(await original.arrayBuffer()));
});

test('cache local não duplica o PDF e a sincronização preserva o original na nuvem',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-requisicao.js'),'utf8');
  const start=app.indexOf('function reqPersist(){');
  const end=app.indexOf('window.wmsReqCloudPush=function(){',start);
  assert.ok(start>=0&&end>start);
  const remote={id:'REQ-CUT-OP-PDF',source_cut_op_id:'OP-PDF',status:'aguardando_corte',updated_date:'2026-10-07T12:00:00Z',source_cut_file:{name:'OP.pdf',base64:'JVBERg=='}};
  const local={...remote,source_cut_file:undefined};
  const storage=new Map();let posted;
  const context={REQS:[local],localStorage:{setItem:(key,value)=>storage.set(key,value)},reqLastLocalSig:'',reqLocalSig:()=>'',REQ_SUPA_URL:'https://example.test/req',reqHeaders:()=>({}),reqStamp:r=>Date.parse(r.updated_date),window:{},encodeURIComponent,Date,JSON,console,
    fetch:async(_url,options)=>options.method?((posted=JSON.parse(options.body)[0].dados),{ok:true}):{ok:true,json:async()=>[{id:remote.id,dados:remote}]}};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  assert.equal(await context.reqPushNow(),true);
  assert.equal(posted.source_cut_file.base64,remote.source_cut_file.base64);
  assert.equal(JSON.parse(storage.get('wmsx_reqs'))[0].source_cut_file,undefined);
  assert.equal(context.REQS[0].source_cut_file.base64,remote.source_cut_file.base64);
});

test('requisição arredonda cada quantidade fracionada para o próximo inteiro',()=>{
  const op={id:'OP-ROUND',ap:'208',lot:'117.10/26',quantity:5000};
  const lines=[{...draft[0],quantity:179.4},{...draft[0],label:'CADARÇO',quantity:6000,unit:'MT'}];
  const req=auto.request(op,lines,'admin','2026-10-06T12:00:00.000Z');
  assert.deepEqual(req.itens.map(item=>item.quantidade),[180,6000]);
  assert.equal(req.itens[0].quantidade_calculada,179.4);
  assert.equal(auto.roundRequestQuantity(0.001),1);
});

test('WMS salva a quantidade arredondada também na requisição de corte manual',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-requisicao.js'),'utf8');
  const start=app.indexOf('window.wmsCreateCutRequest=async function(request){');
  const end=app.indexOf('window.wmsEnsureCutRequest=async function(request){',start);
  const saved=new Map(),context={window:{},REQS:[],localStorage:{getItem:key=>saved.get(key)||null},reqPersist:()=>saved.set('wmsx_reqs',JSON.stringify(context.REQS)),reqPushNow:async()=>true};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const request={id:'REQ-CUT-NEW',source_cut_op_id:'OP-NEW',itens:[{quantidade:179.4},{quantidade:6000}]};
  await context.window.wmsCreateCutRequest(request);
  assert.deepEqual(JSON.parse(saved.get('wmsx_reqs'))[0].itens.map(item=>item.quantidade),[180,6000]);
});

test('sincronização não repõe a quantidade antiga após correção da requisição',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-requisicao.js'),'utf8');
  const start=app.indexOf('async function reqPushNow(){');
  const end=app.indexOf('window.wmsReqCloudPush=function(){',start);
  const old={id:'REQ-CUT-1',numero:'CORTE-AP208',source_cut_op_id:'OP-208',updated_date:'2026-10-06T10:00:00Z',itens:[{quantidade:179.4}]};
  const newer={...old,updated_date:'2026-10-06T11:00:00Z',itens:[{quantidade:180}]};
  let posted,persisted=false;
  const context={REQS:[old],REQ_SUPA_URL:'https://example.test/req',reqLastLocalSig:'',reqLocalSig:()=>'',reqHeaders:()=>({}),reqStamp:r=>Date.parse(r.updated_date),reqPersist:()=>{persisted=true;},cutPending:()=>false,window:{},encodeURIComponent,console,
    fetch:async(_url,options)=>options.method?((posted=JSON.parse(options.body)),{ok:true}):{ok:true,json:async()=>[{id:old.id,dados:newer}]}};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  assert.equal(await context.reqPushNow(),true);
  assert.equal(posted[0].dados.itens[0].quantidade,180);
  assert.equal(persisted,true);
});

test('não libera automaticamente código divergente, OP preenchida inválida ou consumo inválido',()=>{
  const broken=[{...draft[0],op:'123',quantity:0,code:'0303480120'}];
  const checked=auto.validate(broken,catalog,'PP',()=>({score:-1}));
  assert.equal(checked.ok,false);
  assert.match(checked.issues.join(' '),/OP inválido/);
  assert.match(checked.issues.join(' '),/incompatível/);
  assert.match(checked.issues.join(' '),/consumo não calculado/);
});

test('aceita item sem número da OP na requisição e no romaneio',()=>{
  const checked=auto.validate([{...draft[0],op:''}],catalog,'PP',compatible);
  assert.equal(checked.ok,true);
  const record={id:'OP-WMS-SEM-NUMERO',ap:'1184',lot:'78.09.26',client:'CARGILL',quantity:50};
  const req=auto.request(record,checked.lines,'admin','2026-10-06T12:00:00.000Z');
  const exp=auto.romaneio(record,checked.lines,'admin','2026-10-06T12:00:00.000Z');
  assert.equal(req.itens.length,1);
  assert.equal(req.itens[0].op,'');
  assert.equal(req.op,'');
  assert.equal(req.numero.includes('undefined'),false);
  assert.equal(exp.items[0].op,'');
  assert.equal(exp.items[0].codigoMateriaPrima,req.itens[0].codigo);
});

test('romaneio mantém todas as OPs declaradas na ficha para conferir etiquetas de etapas sem código no item',()=>{
  const record={id:'OP-208',ap:'208',lot:'117.10/26',client:'OUROFÉRTIL',operations:['04690601001','04690601004','04690601008']};
  const exp=auto.romaneio(record,[{op:'',label:'SAIA',code:'0303480001',description:'TECIDO PLANO',quantity:1,unit:'KG'}],'admin','2026-10-06T12:00:00.000Z');
  assert.deepEqual(exp.meta.sourceOperations,record.operations);
  assert.equal(exp.items[0].op,'');
});

test('mantém números informados sem inserir número fictício no item vazio',()=>{
  const checked=auto.validate([draft[0],{...draft[0],op:'',label:'VÁLVULA TOPO',quantity:2.5}],catalog,'PP',compatible);
  assert.equal(checked.ok,true);
  const req=auto.request({id:'OP-MISTA',ap:'1184',lot:'78.09.26',quantity:50},checked.lines,'admin','2026-10-06T12:00:00.000Z');
  assert.equal(req.op,'04681501005');
  assert.deepEqual(req.itens.map(item=>item.op),['04681501005','']);
});

test('AP 208 usa QTDE (UN): alças 20.000, demais etapas 5.000',()=>{
  const labels=['CORPO','ALÇA','FUNDO','SAIA','VÁLVULA FUNDO','FLAP FUNDO','CADARÇO VÁLVULA FUNDO','CADARÇO FLAP','CADARÇO SAIA','LINER'];
  const record={id:'OP-208',ap:'208',lot:'117.10/26',client:'OUROFÉRTIL',quantity:5000,
    sheet:{rows:labels.map(label=>({label,piecesPerBag:label==='ALÇA'?4:1}))}};
  const lines=labels.map(label=>({label,op:'',code:'0300000001',description:'MATÉRIA-PRIMA',quantity:label==='ALÇA'?20800:179.4,unit:label==='ALÇA'?'MT':'KG'}));
  const exp=auto.romaneio(record,lines,'admin','2026-10-06T12:00:00.000Z');
  assert.deepEqual(exp.items.map(item=>item.qtdNum),[5000,20000,5000,5000,5000,5000,5000,5000,5000,5000]);
  assert.ok(exp.items.every(item=>item.unidade==='UN'&&item.codigo===''&&item.codigoMateriaPrima==='0300000001'));
});

test('QTDE (UN) explícita da operação prevalece sobre multiplicador da composição',()=>{
  const record={quantity:5000,sheet:{quantity:5000,operationQuantities:{'04690601002':20000},rows:[{op:'04690601002',label:'ALÇA',piecesPerBag:3}]}};
  assert.equal(auto.productionQuantity(record,{op:'04690601002',label:'ALÇA'},0),20000);
});

test('romaneio da OP existente mantém etiquetas e progresso em reimportação',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('window.EXP.ensureCutOpRomaneio=async function(draft){');
  const end=app.indexOf('/* ===================== BAIXA PROTHEUS',start);
  assert.ok(start>=0&&end>start);
  const base=auto.romaneio({id:'OP-WMS-ABC',ap:'1184',lot:'78.09.26',client:'CARGILL',quantity:50},auto.validate(draft,catalog,'PP',compatible).lines,'admin','2026-10-06T12:00:00.000Z');
  const stored={...base,items:[{...base.items[0],feito:4.914,tags:[{tag:'T10000001',q:4.914,conf:true}],status:'conferido'}]};
  let posts=0,saved='';
  const context={window:{EXP:{}},_expBooted:true,romaneios:[],SUPA_REST:'https://example.test/romaneios',supaHeaders:()=>({}),
    validRomaneio:r=>!!(r&&r.meta&&r.meta.loteMain&&r.items&&r.items.length),
    fetch:async(_url,options)=>{if(!options.method)return{ok:true,json:async()=>[{dados:stored}]};posts++;return{ok:true};},
    saveStoreLocal:()=>{saved=JSON.stringify(context.romaneios);},renderLotes:()=>{},mergeRemoteRomaneio:(_local,remote)=>remote,
    Date,JSON,localStorage:{getItem:()=>saved},STORE_KEY:'test',setSupaStatus:()=>{},supaPush:()=>{}};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const result=await context.window.EXP.ensureCutOpRomaneio(base);
  assert.equal(result.created,false);
  assert.equal(result.record.items[0].status,'conferido');
  assert.equal(result.record.items[0].tags[0].tag,'T10000001');
  assert.equal(posts,0);
});

test('requisição da OP existente mantém a separação registrada na nuvem',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-requisicao.js'),'utf8');
  const start=app.indexOf('window.wmsEnsureCutRequest=async function(request){');
  const end=app.indexOf('async function reqPull(){',start);
  assert.ok(start>=0&&end>start);
  const candidate={id:'REQ-CUT-OP-WMS-ABC',source_cut_op_id:'OP-WMS-ABC',itens:[{quantidade:10,quantidade_separada:0}],updated_date:'2026-10-06T10:00:00Z'};
  const remote={...candidate,itens:[{quantidade:10,quantidade_separada:8}],updated_date:'2026-10-06T11:00:00Z'};
  let posts=0;
  const context={window:{},REQS:[candidate],REQ_SUPA_URL:'https://example.test/req',reqHeaders:()=>({}),
    reqStamp:r=>Date.parse(r.updated_date),reqPersist:()=>{},encodeURIComponent,
    fetch:async(_url,options)=>{if(options.method){posts++;return{ok:true};}return{ok:true,json:async()=>[{dados:remote}]};}};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const result=await context.window.wmsEnsureCutRequest(candidate);
  assert.equal(result.record.itens[0].quantidade_separada,8);
  assert.equal(context.REQS[0].itens[0].quantidade_separada,8);
  assert.equal(posts,0);
});

test('OP antiga com requisição em andamento ganha romaneio sem recriar requisição',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-corte.js'),'utf8');
  const start=app.indexOf('async function ensureExpForExistingRequest(record,request){');
  const end=app.indexOf('  var core=window.CutSheetCore',start);
  assert.ok(start>=0&&end>start);
  const op={id:'OP-ANTIGA',ap:'1184',lot:'78.09/26',client:'CARGILL',quantity:50,responsible:'admin'};
  const req={id:'REQ-ANTIGA',numero:'CORTE-AP1184',itens:[{op:'',codigo:'0303480120',material:catalog[0].description,quantidade:4.914,unidade:'KG',maquina:'Corte · VÁLVULA FUNDO',quantidade_separada:2}]};
  let saved=false,submitted;
  const context={window:{CutAutoCore:auto,EXP:{ensureCutOpRomaneio:async record=>{submitted=record;return{record,synced:true};}}},
    saveOpRecord:async()=>{saved=true;},renderSeparation:()=>{},sourceFile:{},dispatchMessage:'',Date,Array,String,Number};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  await context.ensureExpForExistingRequest(op,req);
  assert.equal(submitted.items[0].codigo,'');
  assert.equal(submitted.items[0].codigoMateriaPrima,req.itens[0].codigo);
  assert.equal(submitted.items[0].qtdNum,50);
  assert.equal(submitted.items[0].op,'');
  assert.equal(op.workflow.requestId,req.id);
  assert.equal(saved,true);
});
