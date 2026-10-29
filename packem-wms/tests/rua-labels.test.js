'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const {collect}=require('../rua-labels.js');

const spaces=[
  {w:'70',s:'A',p:10,l:1,o:true,pr:'P100',q:30,u:'KG'},
  {w:'70',s:'A',p:20,l:1,o:true,pr:'P100',q:50,u:'KG'},
  {w:'70',s:'A',p:10,l:2,o:true,pr:'P200',q:40,u:'KG'},
  {w:'70',s:'B',p:10,l:1,o:true,pr:'P300',q:10,u:'KG'},
  {w:'70',s:'A',p:30,l:1,o:false,pr:'',q:0,u:'KG'}
];
const locations={T02:'A-10-1',R01:'A-10-1',T03:'A-20-1',R04:'A-10-2',B05:'B-10-1'};
const labels={R01:{id:'R01',cProd:'P100',kg:10,xProd:'Produto 100',addr:'B-99-9'},R04:{id:'R04',cProd:'P200',kg:40}};
const bobbins={T02:{pr:'P100',pl:20,rem:18,desc:'Produto 100'},T03:{pr:'P100',pl:50,rem:50}};

test('imprime uma etiqueta por vaga ocupada com item e peso do mapa',()=>{
  const before=JSON.stringify({locations,labels,bobbins});
  const result=collect(spaces,locations,labels,bobbins,'A',1);
  assert.deepEqual(result.labels.map(x=>x.addr),['A-10-1','A-20-1']);
  assert.deepEqual(result.labels.map(x=>x.kg),[30,50]);
  assert.equal(result.labels[0].cProd,'P100');
  assert.equal(result.labels[0].qrPayload,'P100$30');
  assert.equal(result.labels[0].id,'');
  assert.equal(result.labels[1].id,'T03');
  assert.equal(result.labels[1].qrPayload,'T03');
  assert.equal(JSON.stringify({locations,labels,bobbins}),before,'preparar impressão não altera o estoque nem cria ID');
});

test('filtra rua e nível sem trazer outra rua ou vaga vazia',()=>{
  const result=collect(spaces,locations,labels,bobbins,'A',2);
  assert.deepEqual(result.labels.map(x=>x.addr),['A-10-2']);
  assert.equal(result.labels[0].id,'R04');
  assert.equal(result.slots,1);
});

test('vaga preenchida manualmente sem cadastro de etiqueta ainda gera QR legível',()=>{
  const result=collect([{w:'70',s:'M',p:280,l:1,o:true,pr:'ITEM 456',q:6720,u:'MT'}],
    {TOLD:'M-280-1'},{},{},'M',1);
  assert.equal(result.labels.length,1);
  assert.deepEqual({product:result.labels[0].cProd,qty:result.labels[0].kg,qr:result.labels[0].qrPayload},
    {product:'ITEM 456',qty:6720,qr:'ITEM 456$6720'});
  assert.equal(result.labels[0].id,'');
});

test('saldo antigo zerado não reutiliza ID; usa item e peso atuais da vaga',()=>{
  const result=collect(spaces,locations,labels,Object.assign({},bobbins,{T02:{pr:'P100',pl:20,rem:0}}),'A',1);
  assert.equal(result.labels[0].id,'');
  assert.equal(result.labels[0].qrPayload,'P100$30');
});

test('QR e endereço aparecem na etiqueta rastreável impressa',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','wms-app.js'),'utf8');
  const start=app.indexOf('function zEtqCard('),end=app.indexOf('function zEtqCSS(',start);
  assert.ok(start>=0&&end>start);
  const ctx={window:{},fmt:n=>String(n),rastEsc:s=>String(s),rastUnit:()=> 'KG',nfDescByCode:()=>'',
    rastQRPayload:e=>e.qrPayload||e.id+' | Vaga: '+e.addr,romQRPayload:()=>'',qrSvg:s=>'<svg data-code="'+s+'"></svg>',f:null};
  vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);
  const html=ctx.zEtqCard({id:'R01',cProd:'P100',xProd:'Produto',kg:10,addr:'A-10-1'},
    {w:100,h:100},100,'mm','rast');
  assert.match(html,/ID: R01/);
  assert.match(html,/VAGA <b>A-10-1<\/b>/);
  assert.ok(html.indexOf('VAGA <b>A-10-1')>html.indexOf('ID: R01'));
  assert.match(html,/data-code="R01 \| Vaga: A-10-1"/);
  const manual=ctx.zEtqCard({id:'',cProd:'ITEM 456',kg:6720,addr:'M-280-1',qrPayload:'ITEM 456$6720'},
    {w:100,h:100},100,'mm','rast');
  assert.match(manual,/data-code="ITEM 456\$6720"/);
  assert.match(manual,/VAGA <b>M-280-1<\/b>/);
});
