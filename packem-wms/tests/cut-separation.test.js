const test=require('node:test');
const assert=require('node:assert/strict');
const separation=require('../cut-separation-core.js');
const cut=require('../cut-sheet-core.js');

test('urgência de um material aparece somente na OP vinculada',()=>{
  const op={id:'OP-208',operations:['04690601005']};
  const requests=[
    {source_cut_op_id:'OP-208',status:'pendente',numero:'CORTE-AP208',itens:[{id:'A',etapa_corte:'VÁLVULA FUNDO',maquina:'CT11 - VALVULAS',codigo:'0303480120',prioridade_logistica:'urgente'},{id:'B',prioridade_logistica:'normal'}]},
    {source_cut_op_id:'OP-OUTRA',status:'pendente',itens:[{id:'C',prioridade_logistica:'critico'}]},
    {source_cut_op_id:'OP-208',status:'cancelado',itens:[{id:'D',prioridade_logistica:'critico'}]}
  ];
  assert.deepEqual(separation.urgentForOp(op,requests),[{id:'A',stage:'VÁLVULA FUNDO',machine:'CT11 - VALVULAS',code:'0303480120',material:'',priority:'urgente',requestNumber:'CORTE-AP208',requestedAt:''}]);
});

test('itens urgentes da ficha seguem a ordem em que o corte pediu',()=>{
  const op={id:'OP-208',operations:[]};
  const requests=[{source_cut_op_id:'OP-208',status:'pendente',numero:'CORTE-AP208',itens:[
    {id:'B',etapa_corte:'ALÇA',prioridade_logistica:'critico',urgencia_solicitada_em:'2026-10-07T13:00:00.000Z'},
    {id:'A',etapa_corte:'FUNDO',prioridade_logistica:'urgente',urgencia_solicitada_em:'2026-10-07T12:30:00.000Z'}
  ]}];
  assert.deepEqual(separation.urgentForOp(op,requests).map(item=>item.id),['A','B']);
});

test('urgências antigas usam o horário registrado no histórico da requisição',()=>{
  const op={id:'OP-208',operations:[]};
  const requests=[{source_cut_op_id:'OP-208',status:'pendente',created_date:'2026-10-07T12:00:00.000Z',itens:[
    {id:'B',codigo:'002',maquina:'CT17 - FUNDO',prioridade_logistica:'urgente'},
    {id:'A',codigo:'001',maquina:'CT11 - VALVULAS',prioridade_logistica:'urgente'}
  ],historico:[
    {ts:'2026-10-07T13:00:00.000Z',acao:'Urgência do item enviada à logística',detalhe:'002 · CT17 - FUNDO · prioridade urgente'},
    {ts:'2026-10-07T12:30:00.000Z',acao:'Urgência do item enviada à logística',detalhe:'001 · CT11 - VALVULAS · prioridade urgente'}
  ]}];
  assert.deepEqual(separation.urgentForOp(op,requests).map(item=>item.id),['A','B']);
});

test('vincula separação somente pelo número exato da OP',()=>{
  const operations=['04681501001','04681501002'];
  assert.equal(separation.matches({op:'04681501001',numero:'123'},operations),true);
  assert.equal(separation.matches({op:'046815010011',numero:'123'},operations),false);
  assert.equal(separation.matches({op:'',numero:'04681501002'},operations),true);
  assert.equal(separation.matches({op:'99999999999',numero:'04681501001'},operations),false);
  assert.equal(separation.matches({numero:'CORTE-78-123',observacoes:'Ficha AP 1184 · OPs 04681501001, 04681501002 · arquivo original'},operations),true);
});

test('mostra ausência de separação sem inventar zero por cento',()=>{
  const result=separation.summarize(['04681501001'],[{op:'outra OP',itens:[{quantidade:1,quantidade_separada:1}]}]);
  assert.equal(result.linked,false);
  assert.equal(result.percent,null);
});

test('acompanha separação da OP sem números de etapa pelo identificador da ficha',()=>{
  const result=separation.summarize([],[
    {source_cut_op_id:'OP-WMS-ABC',op:'',numero:'CORTE-AP1184-ABC',itens:[{quantidade:10,quantidade_separada:5}]},
    {source_cut_op_id:'OP-WMS-OUTRA',op:'',numero:'CORTE-AP1184-OUTRA',itens:[{quantidade:10,quantidade_separada:10}]}
  ],'OP-WMS-ABC');
  assert.equal(result.linked,true);
  assert.equal(result.percent,50);
  assert.equal(result.requests.length,1);
});

test('mostra progresso registrado e desconsidera requisição cancelada',()=>{
  const result=separation.summarize(['04681501001'],[
    {op:'04681501001',numero:'REQ-1',status:'em_separacao',itens:[{quantidade:10,quantidade_separada:5},{quantidade:10,quantidade_separada:10}]},
    {op:'04681501001',numero:'REQ-2',status:'cancelado',itens:[{quantidade:10,quantidade_separada:0}]}
  ]);
  assert.equal(result.linked,true);
  assert.equal(result.percent,75);
  assert.equal(result.bippedPercent,0);
  assert.equal(result.complete,1);
  assert.equal(result.items,2);
  assert.equal(result.requests.length,2);
});

test('separação não soma quilos com metros e conta as etiquetas de matéria-prima bipadas',()=>{
  const result=separation.summarize([],[{source_cut_op_id:'OP-WMS-1',status:'em_separacao',itens:[
    {quantidade:100,quantidade_separada:50,unidade:'KG',fifo_etiquetas:[{et:'T1',q:50}]},
    {quantidade:1000,quantidade_separada:1000,unidade:'MT',fifo_etiquetas:[{et:'T2',q:1000}]}
  ]}],'OP-WMS-1');
  assert.equal(result.percent,75);
  assert.equal(result.bippedPercent,75);
  assert.equal(result.bippedLabels,2);
  assert.deepEqual(result.units,{KG:{requested:100,separated:50,bipped:50},MT:{requested:1000,separated:1000,bipped:1000}});
});

test('monta uma linha por etapa e OP, mantendo a quantidade do grupo',()=>{
  const sheet={quantity:50},rows=[
    {op:'04681501005',label:'VÁLVULA FUNDO',family:'laminado-tubular',description:'TBL 48 + 12 G X 65 CM BR',dimensions:'0,75 X 0,65',piecesPerBag:1},
    {op:'04681501006',label:'VÁLVULA TOPO',family:'laminado-tubular',description:'TBL 48 + 12 G X 65 CM BR',dimensions:'0,51 X 0,65',piecesPerBag:1}
  ];
  const entries=[{group:{description:rows[0].description,rows},unit:'KG',code:'0303480120',manualPerBag:null,verified:true}];
  const lines=separation.buildDraft(sheet,entries,cut);
  assert.deepEqual(lines.map(x=>x.op),['04681501005','04681501006']);
  assert.equal(lines.length,2);
  assert.equal(Math.round(lines.reduce((a,x)=>a+x.quantity,0)*1000)/1000,4.914);
});
