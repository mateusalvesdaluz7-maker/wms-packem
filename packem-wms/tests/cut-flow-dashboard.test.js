const test=require('node:test');
const assert=require('node:assert/strict');
const dashboard=require('../cut-flow-dashboard-core.js');

test('mede a separação e a conferência apenas pelos horários registrados',()=>{
  const op={id:'OP-1',createdAt:'2026-10-08T08:00:00.000Z'};
  const request={id:'REQ-1',status:'entregue',ts_inicio_separacao:'2026-10-08T09:00:00.000Z',ts_fim_separacao:'2026-10-08T10:30:00.000Z'};
  const record={id:'EXP-1',_audit:[
    {acao:'romaneio_criado_da_op',at:'2026-10-08T08:00:00.000Z'},
    {acao:'bip_separacao',at:'2026-10-08T11:00:00.000Z'},
    {acao:'bip_conferencia',at:'2026-10-08T11:45:00.000Z'}
  ]};
  const result=dashboard.summarize([{op,separation:{linked:true,percent:100,requests:[request]},expedition:{record,percent:100},overallPercent:100}],'2026-10-08T12:00:00.000Z');
  assert.equal(result.separation.averageMinutes,90);
  assert.equal(result.expedition.averageMinutes,45);
  assert.equal(result.completedOps,1);
  assert.equal(result.averageOpMinutes,225);
  assert.equal(result.items[0].sepRemaining,0);
});

test('estima o restante somente quando a etapa já tem ritmo medido',()=>{
  const op={id:'OP-2',createdAt:'2026-10-08T09:00:00.000Z'};
  const request={id:'REQ-2',status:'em_separacao',ts_inicio_separacao:'2026-10-08T10:00:00.000Z'};
  const active=dashboard.summarize([{op,separation:{linked:true,percent:50,requests:[request]},expedition:{record:{id:'EXP-2',_audit:[]},percent:0},overallPercent:20}],'2026-10-08T10:30:00.000Z');
  assert.equal(active.items[0].sepRemaining,30);
  assert.equal(active.items[0].expRemaining,null);
  assert.equal(active.items[0].opRemaining,360);
  assert.equal(active.expedition.averageMinutes,null);
  const noProgress=dashboard.summarize([{op,separation:{linked:true,percent:0,requests:[request]},expedition:{record:null,percent:null}}],'2026-10-08T10:30:00.000Z');
  assert.equal(noProgress.items[0].sepRemaining,null);
  assert.equal(noProgress.items[0].expLinked,false);
  const paused=dashboard.summarize([{op,separation:{linked:true,percent:50,requests:[{...request,status:'pausado'}]},expedition:{record:null,percent:null}}],'2026-10-08T10:30:00.000Z');
  assert.equal(paused.items[0].sepRemaining,null);
});

test('exclui processos cancelados das médias e não inventa tempo sem auditoria',()=>{
  const result=dashboard.summarize([
    {op:{id:'OP-3'},separation:{linked:true,percent:80,requests:[{id:'REQ-3',status:'cancelado'}]},expedition:{record:{id:'EXP-3',cancelado:true},percent:80}},
    {op:{id:'OP-4'},separation:{linked:false,percent:null,requests:[]},expedition:{record:{id:'EXP-4',_audit:[]},percent:100}}
  ],'2026-10-08T12:00:00.000Z');
  assert.equal(result.separation.total,0);
  assert.equal(result.expedition.total,1);
  assert.equal(result.expedition.averageMinutes,null);
  assert.equal(dashboard.duration(null),'—');
});

test('mede cada etapa com seu próprio marco e trata a exportação do PCP como imediata',()=>{
  const request={id:'REQ-4',status:'entregue',created_date:'2026-10-08T08:00:00.000Z',liberada_em:'2026-10-08T09:00:00.000Z',historico:[{acao:'Corte escolheu materiais para a logística',ts:'2026-10-08T08:20:00.000Z'}],selecao_corte_requerida:true,ts_inicio_separacao:'2026-10-08T08:30:00.000Z',ts_fim_separacao:'2026-10-08T10:00:00.000Z'};
  const record={id:'EXP-4',_audit:[
    {acao:'bip_separacao',at:'2026-10-08T11:00:00.000Z'},
    {acao:'bip_separacao',at:'2026-10-08T11:15:00.000Z'},
    {acao:'bip_conferencia',at:'2026-10-08T11:20:00.000Z'},
    {acao:'bip_conferencia',at:'2026-10-08T11:50:00.000Z'}
  ]};
  const row={op:{id:'OP-4',createdAt:'2026-10-08T08:00:00.000Z'},separation:{linked:true,percent:100,requests:[request]},expedition:{record,percent:100,quantities:{scannedPercent:100}}};
  const item=dashboard.summarize([row],'2026-10-08T12:00:00.000Z').items[0];
  const times=dashboard.flowStageTimes(row,item,'2026-10-08T12:00:00.000Z');
  assert.equal(times.pcp.elapsedMinutes,0);
  assert.equal(times.request.elapsedMinutes,20);
  assert.equal(times.separation.elapsedMinutes,90);
  assert.equal(times.productScan.elapsedMinutes,15);
  assert.equal(times.expedition.elapsedMinutes,30);
  assert.equal(times.production.elapsedMinutes,null);
});

test('não atribui tempo de produção nem de bipagem sem registros',()=>{
  const row={op:{id:'OP-5',createdAt:'2026-10-08T08:00:00.000Z'},separation:{linked:true,percent:0,requests:[{id:'REQ-5',status:'pendente',created_date:'2026-10-08T08:05:00.000Z',selecao_corte_requerida:true}]},expedition:{record:{id:'EXP-5',_audit:[]},percent:0,quantities:{scannedPercent:0}}};
  const item=dashboard.summarize([row],'2026-10-08T08:30:00.000Z').items[0];
  const times=dashboard.flowStageTimes(row,item,'2026-10-08T08:30:00.000Z');
  assert.equal(times.request.ready,false);
  assert.equal(times.request.elapsedMinutes,25);
  assert.equal(times.separation.elapsedMinutes,null);
  assert.equal(times.production.elapsedMinutes,null);
  assert.equal(times.productScan.elapsedMinutes,null);
  assert.equal(times.expedition.elapsedMinutes,null);
});

test('mede a espera da separação desde a primeira liberação do corte',()=>{
  const row={op:{id:'OP-6',createdAt:'2026-10-08T08:00:00.000Z'},separation:{linked:true,percent:0,requests:[{id:'REQ-6',status:'pendente',created_date:'2026-10-08T08:00:00.000Z',liberada_em:'2026-10-08T08:10:00.000Z',selecao_corte_requerida:true}]},expedition:{record:null,percent:0,quantities:{scannedPercent:0}}};
  const item=dashboard.summarize([row],'2026-10-08T08:30:00.000Z').items[0];
  const times=dashboard.flowStageTimes(row,item,'2026-10-08T08:30:00.000Z');
  assert.equal(times.request.ready,true);
  assert.equal(times.request.elapsedMinutes,10);
  assert.equal(times.separation.waitingMinutes,20);
  assert.equal(times.separation.elapsedMinutes,null);
});
