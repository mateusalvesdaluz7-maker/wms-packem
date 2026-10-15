const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../fitilho-stock-core.js');

test('bipagem da Extrusora registra cada bobina uma vez e soma o estoque',()=>{
  let state=core.receive(core.initial(),{label:'fit-001',area:'pp-21',productCode:'fita-01',lot:'lote-a',kg:'32,5',op:'OP-10',by:'Extrusora'});
  state=core.receive(state,{label:'FIT-002',area:'pp-21',productCode:'FITA-01',lot:'LOTE-A',kg:30});
  assert.equal(core.inventory(state).availableKg,62.5);
  assert.equal(core.inventory(state).byCode[0].bobbins,2);
  assert.throws(()=>core.receive(state,{label:'FIT-001',area:'pp-21',productCode:'FITA-01',lot:'LOTE-A',kg:32.5}),/já foi registrada/);
});

test('Tear requisita fitilho e a bipagem faz saída e registra consumo na OP',()=>{
  let state=core.receive(core.initial(),{label:'FIT-001',area:'pp-21',productCode:'FITA-01',lot:'L1',kg:32.5});
  state=core.receive(state,{label:'FIT-002',area:'pp-21',productCode:'FITA-01',lot:'L1',kg:30});
  state=core.request(state,{id:'REQ-1',area:'pp-21',tearOp:'OP-TEAR-9',productCode:'FITA-01',usage:'warp',kg:60,by:'Tear'});
  state=core.dispatch(state,'REQ-1',{label:'FIT-001',by:'Logística'});
  assert.equal(core.inventory(state).availableKg,30);
  assert.equal(core.inventory(state).dispatchedKg,32.5);
  assert.equal(core.requestProgress(state,'REQ-1').deliveredKg,32.5);
  assert.deepEqual(state.requests[0].deliveries[0].tearOp,'OP-TEAR-9');
  assert.equal(state.requests[0].deliveries[0].usage,'warp');
  assert.throws(()=>core.dispatch(state,'REQ-1',{label:'FIT-001'}),/já saiu/);
  state=core.dispatch(state,'REQ-1',{label:'FIT-002'});
  assert.equal(core.requestProgress(state,'REQ-1').complete,true);
  assert.equal(core.requestProgress(state,'REQ-1').excessKg,2.5);
  assert.equal(core.inventory(state).availableKg,0);
});

test('requisição de outro código não consegue retirar bobina do estoque',()=>{
  let state=core.receive(core.initial(),{label:'FIT-001',area:'pp-21',productCode:'FITA-01',lot:'L1',kg:20});
  state=core.request(state,{id:'REQ-1',area:'pp-21',tearOp:'TEAR-1',productCode:'FITA-02',usage:'weft',kg:20});
  assert.throws(()=>core.dispatch(state,'REQ-1',{label:'FIT-001'}),/não corresponde/);
  assert.equal(core.inventory(state).availableKg,20);
  assert.equal(core.requestProgress(state,'REQ-1').deliveredKg,0);
});

test('PET 24 e PP 21 mantêm saldos separados e impedem saída de área errada',()=>{
  let state=core.receive(core.initial(),{label:'PET-001',area:'pet-24',productCode:'FITA-01',lot:'L1',kg:18});
  state=core.receive(state,{label:'PP-001',area:'pp-21',productCode:'FITA-01',lot:'L2',kg:22});
  state=core.request(state,{id:'REQ-PP',area:'pp-21',tearOp:'TEAR-2',productCode:'FITA-01',usage:'warp',kg:20});
  assert.equal(core.inventory(state,'pet-24').availableKg,18);
  assert.equal(core.inventory(state,'pp-21').availableKg,22);
  assert.throws(()=>core.dispatch(state,'REQ-PP',{label:'PET-001'}),/outro estoque/);
  state=core.dispatch(state,'REQ-PP',{label:'PP-001'});
  assert.equal(core.inventory(state,'pet-24').availableKg,18);
  assert.equal(core.inventory(state,'pp-21').availableKg,0);
});

test('registros anteriores continuam disponíveis para classificação de setor',()=>{
  const old={version:1,bobbins:[{label:'ANTIGA-1',productCode:'FITA-01',lot:'L1',kg:10,status:'stock'}],requests:[]};
  let state=core.normalize(old);
  assert.equal(core.inventory(state,'').availableKg,10);
  assert.equal(state.bobbins[0].materialType,'fitilho');
  state=core.assignArea(state,'bobbin','ANTIGA-1','pet-24');
  assert.equal(core.inventory(state,'pet-24').availableKg,10);
  assert.equal(core.inventory(state,'').availableKg,0);
});

test('bipagem transfere material do estoque à máquina e mostra a posição atual',()=>{
  let state=core.receive(core.initial(),{label:'MP-001',area:'pp-21',materialType:'materia-prima',productCode:'RESINA-01',lot:'L1',kg:25});
  state=core.sendToMachine(state,{label:'MP-001',area:'pp-21',machine:'EXTRUSORA-1',op:'OP-44',by:'Operador'});
  assert.equal(core.inventory(state,'pp-21').availableKg,0);
  assert.equal(core.machines(state,'pp-21')[0].kg,25);
  assert.equal(core.machines(state,'pp-21')[0].bobbins[0].machineOp,'OP-44');
  assert.equal(state.movements[0].type,'saida-maquina');
  assert.throws(()=>core.sendToMachine(state,{label:'MP-001',area:'pp-21',machine:'EXTRUSORA-1'}),/já saiu/);
});

test('consumo parcial mantém saldo na máquina e retorno devolve só o restante',()=>{
  let state=core.receive(core.initial(),{label:'MP-002',area:'pet-24',materialType:'materia-prima',productCode:'RESINA-02',kg:30});
  state=core.sendToMachine(state,{label:'MP-002',area:'pet-24',machine:'PET-1'});
  assert.throws(()=>core.consumeMachine(state,{label:'MP-002',area:'pet-24',machine:'PET-2',kg:5}),/outra máquina/);
  assert.throws(()=>core.consumeMachine(state,{label:'MP-002',area:'pet-24',machine:'PET-1',kg:31}),/maior/);
  state=core.consumeMachine(state,{label:'MP-002',area:'pet-24',machine:'PET-1',kg:12.5});
  assert.equal(core.machines(state,'pet-24')[0].kg,17.5);
  state=core.returnFromMachine(state,{label:'MP-002',area:'pet-24',machine:'PET-1'});
  assert.equal(core.machines(state,'pet-24').length,0);
  assert.equal(core.inventory(state,'pet-24').availableKg,17.5);
  assert.equal(state.movements[0].kg,17.5);
});

test('saída comum e consumo completo removem a etiqueta do saldo disponível',()=>{
  let state=core.receive(core.initial(),{label:'MP-003',area:'pp-21',materialType:'materia-prima',productCode:'RESINA-03',kg:8});
  state=core.receive(state,{label:'MP-004',area:'pp-21',materialType:'materia-prima',productCode:'RESINA-03',kg:5});
  state=core.exitStock(state,{label:'MP-003',area:'pp-21',destination:'Laboratório'});
  assert.equal(core.inventory(state,'pp-21').availableKg,5);
  assert.equal(state.bobbins.find(row=>row.label==='MP-003').destination,'Laboratório');
  state=core.sendToMachine(state,{label:'MP-004',area:'pp-21',machine:'PP-1'});
  state=core.consumeMachine(state,{label:'MP-004',area:'pp-21',machine:'PP-1'});
  assert.equal(core.machines(state,'pp-21').length,0);
  assert.equal(core.inventory(state,'pp-21').availableKg,0);
  assert.equal(state.movements[0].type,'consumo-maquina');
});

test('matéria-prima abastece a Extrusora e fitilho produzido atende somente o Tear',()=>{
  let state=core.receive(core.initial(),{label:'MP-005',area:'pp-21',materialType:'materia-prima',productCode:'RESINA-05',kg:10});
  state=core.receive(state,{label:'FIT-005',area:'pp-21',materialType:'fitilho',productCode:'FITA-05',kg:7});
  state=core.request(state,{id:'REQ-5',area:'pp-21',tearOp:'TEAR-5',productCode:'RESINA-05',usage:'warp',kg:10});
  assert.throws(()=>core.dispatch(state,'REQ-5',{label:'MP-005'}),/Tear requisita fitilho/);
  assert.throws(()=>core.sendToMachine(state,{label:'FIT-005',area:'pp-21',machine:'PP-1'}),/máquina da Extrusora recebe matéria-prima/);
  state=core.sendToMachine(state,{label:'MP-005',area:'pp-21',machine:'PP-1'});
  assert.equal(core.machines(state,'pp-21')[0].kg,10);
  assert.equal(core.inventory(state,'pp-21').availableKg,7);
});

test('bipe da requisição encaminha uma etiqueta somente ao estoque PP ou PET indicado',()=>{
  const requests=[{id:'REQ-PP',status:'em_separacao',itens:[{id:'ITEM-1',codigo:'RESINA-PP',material:'Resina PP',maquina:'Extrusora PP',unidade:'KG',fifo_etiquetas:[{et:'MP-PP-1',q:24,extrusora_area:'pp-21'}]}]},{id:'REQ-PET',status:'separado',itens:[{id:'ITEM-2',codigo:'RESINA-PET',material:'Resina PET',maquina:'Extrusora PET',unidade:'KG',fifo_etiquetas:[{et:'MP-PET-1',q:18,extrusora_area:'pet-24'}]}]}];
  const delivery=core.requestDelivery(requests,'mp-pp-1','pp-21');
  assert.equal(delivery.requestId,'REQ-PP');
  assert.equal(delivery.kg,24);
  assert.throws(()=>core.requestDelivery(requests,'MP-PP-1','pet-24'),/PP - 21/);
  let state=core.receiveFromRequest(core.initial(),delivery);
  assert.equal(core.inventory(state,'pp-21').availableKg,24);
  assert.equal(core.inventory(state,'pet-24').availableKg,0);
  assert.equal(state.bobbins[0].sourceRequestId,'REQ-PP');
  assert.equal(state.movements[0].requestId,'REQ-PP');
  state=core.receiveFromRequest(state,delivery);
  assert.equal(state.bobbins.length,1);
  assert.equal(state.movements.length,1);
  assert.throws(()=>core.receiveFromRequest(state,{...delivery,area:'pet-24'}),/outro lançamento ou estoque/);
});

test('entrada automática recusa unidade diferente de kg, etiqueta ambígua e requisição cancelada',()=>{
  const item={id:'I-1',codigo:'RESINA',unidade:'MT',fifo_etiquetas:[{et:'ET-1',q:12,extrusora_area:'pp-21'}]};
  const request={id:'REQ-1',status:'em_separacao',itens:[item]};
  const delivery=core.requestDelivery([request],'ET-1','pp-21');
  assert.throws(()=>core.receiveFromRequest(core.initial(),delivery),/exige quantidade em KG/);
  assert.equal(core.requestDelivery([{...request,status:'cancelado'}],'ET-1','pp-21'),null);
  assert.throws(()=>core.requestDelivery([request,{...request,id:'REQ-2'}],'ET-1','pp-21'),/mais de uma requisição/);
});
