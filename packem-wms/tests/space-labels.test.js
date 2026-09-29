'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '..', 'wms-app.js'), 'utf8');

function setup({qty = 150, bob = {}, labels = {}, locations = {}, unit = 'KG', failTable, cloudBob = {}} = {}) {
  const space = {id:'70_I_70_1',pr:'0303010066',q:qty,o:true,upd:'2026-09-29T12:00:00Z'};
  const cloud = {espacos:[{...space}],locais:Object.entries(locations).map(([etiqueta,code])=>({etiqueta,code})),etiquetas:[],bobinas:[]};
  const printed = [], toasts = [], writes = [];
  const context = {
    window:{},S:[space],BOB:structuredClone(bob),ETQ:structuredClone(labels),LOC:{...locations},supa:{
      from(table){return {
        select(){return {eq(key,value){return Promise.resolve({data:cloud[table].filter(r=>r[key]===value)});}};},
        async upsert(row){writes.push(table);if(table===failTable)return {error:{message:'rede'}};
          const key=table==='etiquetas'?'id':'etiqueta',index=cloud[table].findIndex(r=>r[key]===row[key]);
          if(index>=0)cloud[table][index]={...row};else cloud[table].push({...row});return {error:null};}
      };}
    },
    norm:s=>String(s||'').trim().toUpperCase(),code:()=> 'I-70-1',unitOf:()=>unit,descOf:()=> 'FITA PET 1950 DTEX 2MM CRISTAL',
    nowISO:()=> '2026-09-29T12:30:00Z',session:{u:'admin'},
    saveNF(){},saveBOB(){},saveLOC(){},logAct(){},closeDrawer(){},
    etqRow:e=>({id:e.id,c_prod:e.cProd,kg:e.kg,addr:e.addr}),
    printZebraRast:arr=>printed.push(structuredClone(arr)),ZSIZES:{z100:{w:100,h:100}},toast:msg=>toasts.push(msg),
  };
  context.bobFetch=async et=>{if(!context.BOB[et]&&cloudBob[et])context.BOB[et]={...cloudBob[et]};return context.BOB[et]||null;};
  context.syncEtiqueta=async e=>!(await context.supa.from('etiquetas').upsert(context.etqRow(e))).error;
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function spaceTrackingPlan('),app.indexOf('/* wraps p/ gravar cada ação na nuvem */')),context);
  return {context,space,cloud,printed,toasts,writes};
}

test('imprime todas as etiquetas bipadas e manuais preservando os IDs',async()=>{
  const t=setup({bob:{T1:{pr:'0303010066',pl:100},R1:{pr:'0303010066',pl:50}},locations:{T1:'I-70-1',R1:'I-70-1'}});
  await t.context.printSpaceTrackingLabels(t.space.id);
  assert.equal(t.printed[0].length,2);
  assert.deepEqual(t.printed[0].map(e=>e.id).sort(),['R1','T1']);
  assert.equal(t.printed[0].reduce((s,e)=>s+e.kg,0),150);
  assert.ok(t.printed[0].every(e=>e.addr==='I-70-1'));
  assert.deepEqual(t.writes,[]);
});

test('saldo manual antigo recebe ID bipável apenas para a diferença; reimpressão reutiliza',async()=>{
  const t=setup({bob:{T1:{pr:'0303010066',pl:100}},locations:{T1:'I-70-1'},unit:'MT'});
  const before=JSON.stringify(t.space);
  await t.context.printSpaceTrackingLabels(t.space.id);
  const manual=t.printed[0].find(e=>e.id!=='T1');
  assert.equal(manual.kg,50);assert.match(manual.id,/^R[0-9A-Z]{8,}$/);assert.equal(manual.uCom,'MT');
  assert.equal(t.context.LOC[manual.id],'I-70-1');assert.equal(t.context.BOB[manual.id].rem,50);
  assert.equal(JSON.stringify(t.space),before);
  await t.context.printSpaceTrackingLabels(t.space.id);
  assert.deepEqual(t.printed[1].map(e=>e.id).sort(),t.printed[0].map(e=>e.id).sort());
  assert.equal(t.cloud.etiquetas.length,1);assert.equal(t.cloud.locais.length,2);
});

test('vaga inteiramente manual gera etiqueta para o saldo completo',async()=>{
  const t=setup({qty:6720,unit:'MT'});
  await t.context.printSpaceTrackingLabels(t.space.id);
  assert.equal(t.printed[0].length,1);assert.equal(t.printed[0][0].kg,6720);assert.equal(t.printed[0][0].uCom,'MT');
});

test('saída parcial imprime saldo restante e ignora etiquetas zeradas',async()=>{
  const t=setup({qty:40,bob:{T1:{pr:'0303010066',pl:100,rem:40},T2:{pr:'0303010066',pl:30,rem:0}},locations:{T1:'I-70-1',T2:'I-70-1'}});
  await t.context.printSpaceTrackingLabels(t.space.id);
  assert.equal(t.printed[0].length,1);assert.equal(t.printed[0][0].kg,40);assert.deepEqual(t.writes,[]);
});

test('cadastro ausente, produto divergente ou soma excedente não criam rastreio',async()=>{
  for(const bob of [{},{T1:{pr:'OUTRO',pl:50}},{T1:{pr:'0303010066',pl:200}}]){
    const t=setup({bob,locations:{T1:'I-70-1'}});
    await t.context.printSpaceTrackingLabels(t.space.id);
    assert.equal(t.printed.length,0);assert.deepEqual(t.writes,[]);assert.ok(t.toasts.length);
  }
});

test('consulta etiqueta ainda não carregada e não cria saldo manual falso',async()=>{
  const t=setup({locations:{T1:'I-70-1'},cloudBob:{T1:{pr:'0303010066',pl:150}}});
  await t.context.printSpaceTrackingLabels(t.space.id);
  assert.equal(t.printed[0][0].id,'T1');assert.deepEqual(t.writes,[]);
});

test('falha de cadastro na nuvem impede impressão; repetir reutiliza o mesmo ID',async()=>{
  const t=setup({failTable:'locais'});
  await t.context.printSpaceTrackingLabels(t.space.id);
  const id=Object.keys(t.context.ETQ)[0];
  assert.equal(t.printed.length,0);
  await t.context.printSpaceTrackingLabels(t.space.id);
  assert.deepEqual(Object.keys(t.context.ETQ),[id]);assert.equal(t.cloud.etiquetas.length,1);
});

test('duplo clique não duplica o rastreio e saldo alterado durante consulta bloqueia',async()=>{
  const t=setup();
  await Promise.all([t.context.printSpaceTrackingLabels(t.space.id),t.context.printSpaceTrackingLabels(t.space.id)]);
  assert.equal(t.printed.length,1);assert.equal(t.cloud.etiquetas.length,1);
  const changed=setup();const pending=changed.context.printSpaceTrackingLabels(changed.space.id);changed.space.q=160;
  await pending;assert.equal(changed.printed.length,0);assert.equal(changed.writes.length,0);
});

test('modelo de rastreio traz endereço atual abaixo do ID e no QR, com unidade correta',()=>{
  const ctx={LOC:{T20358969:'I-70-1'},window:{},nfDescByCode:()=>'',normUnit:u=>u,fmt:q=>String(q).replace('.',','),qrSvg:s=>'<svg data-payload="'+s+'"></svg>'};
  vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('function rastEsc('),app.indexOf('function zEtqCSS(')),ctx);
  const e={id:'T20358969',cProd:'0303010066',kg:371.5,uCom:'MT',addr:'A-10-1'};
  const html=ctx.zEtqCard(e,{w:100,h:100},100,'mm','rast');
  assert.match(html,/371,5 MT/);assert.match(html,/ENDEREÇO: I-70-1/);assert.ok(html.indexOf('ID: T20358969')<html.indexOf('ENDEREÇO:'));
  assert.match(ctx.rastQRPayload(e),/^T20358969 \|/);assert.match(ctx.rastQRPayload(e),/Vaga: I-70-1/);
  const empty=ctx.zEtqCard({...e,id:'OUTRA',addr:''},{w:100,h:100},100,'mm','rast');assert.doesNotMatch(empty,/ENDEREÇO:/);
});

test('reimpressão de bobina usa modelo de rastreio e mantém ID, endereço e saldo parcial',()=>{
  let printed;
  const ctx={BOB:{T20358969:{pr:'0303410001',pl:6720,rem:3200,desc:'ALÇA PP'}},ETQ:{},LOC:{T20358969:'I-70-1'},
    findSpace:()=>({u:'MT'}),unitOf:()=> 'MT',nfDescByCode:()=>'',ZSIZES:{z100:{w:100,h:100}},toast(){},printZebraRast:arr=>{printed=arr;}};
  vm.createContext(ctx);vm.runInContext(app.slice(app.indexOf('function rastLabelAddress('),app.indexOf('function rastQRPayload(')),ctx);
  vm.runInContext(app.slice(app.lastIndexOf('printBobLabel=function(et)'),app.indexOf('printGuide=function(o)')),ctx);
  ctx.printBobLabel('T20358969');
  assert.equal(printed[0].id,'T20358969');assert.equal(printed[0].kg,3200);assert.equal(printed[0].uCom,'MT');assert.equal(printed[0].addr,'I-70-1');
});
