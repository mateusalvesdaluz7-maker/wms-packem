const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('VSM usa uma aba própria e sai do painel de OPs',()=>{
  const html=read('index.html'),app=read('wms-app.js'),cut=read('wms-corte.js');
  assert.match(html,/data-view="v-flow"/);
  assert.match(html,/id="v-flow"/);
  assert.match(html,/wms-vsm-live\.js\?v=/);
  assert.match(app,/\['v-flow','VSM ao vivo'\]/);
  assert.doesNotMatch(cut,/paintFlowDashboard\(\);/);
  assert.doesNotMatch(cut,/dashboard\.id='cutFlowDashboard'/);
});

test('VSM lê as etapas reais e preserva os indicadores simples da OP',()=>{
  const cut=read('wms-corte.js'),vsm=read('wms-vsm-live.js');
  assert.match(cut,/window\.wmsCorteFlowSnapshot=async function/);
  assert.match(cut,/CutFlowDashboardCore\.summarize\(rows/);
  assert.match(cut,/material\.percent/);
  assert.match(cut,/output\.confirmedPercent/);
  for(const phase of ['Requisição','Separação','Produção','Produto bipado','Expedição'])assert.ok(vsm.includes(phase));
  assert.match(vsm,/setInterval\(function\(\)\{if\(view\.classList\.contains\('active'\)/);
});
