'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'wms-app.js'), 'utf8');
const requisicao = fs.readFileSync(path.join(root, 'wms-requisicao.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

test('não recria usuários ou senhas fixas no navegador', function () {
  assert.equal(app.includes('ensureRequestedUsersAug18'), false);
  assert.equal(app.includes('reqPins'), false);
  ['6842', '3175', '9084', '5261'].forEach(function (pin) {
    assert.equal(app.includes("'" + pin + "'"), false);
  });
});

test('a operação de estoque passa pela API transacional', function () {
  const rewrite = (vercel.rewrites || []).find(function (item) {
    return item.source === '/wms-data/stock-operation';
  });
  assert.ok(rewrite);
  assert.equal(rewrite.destination, '/api/stock-operation');
});

test('requisição completa aguarda confirmação após bip ou quantidade', function () {
  const requestApi = fs.readFileSync(path.join(root, 'api', 'req-baixa.js'), 'utf8');
  assert.match(app, /r\.status='separado';r\.ts_fim_separacao=fim/);
  assert.match(requestApi, /status: 'separado'/);
  assert.match(requestApi, /requestStatus = 'separado'/);
});

test('criação e alterações locais de requisição disparam sincronização com a nuvem', function () {
  assert.match(requisicao, /REQS\.unshift\(r\);try\{reqPersist\(\);window\.wmsReqCloudPush\(\);\}/);
  assert.match(requisicao, /reqLocalSig\(\)!==reqLastLocalSig\)window\.wmsReqCloudPush\(\)/);
  assert.match(requisicao, /reqLastLocalSig=reqLocalSig\(\)/);
});

test('recebimento cria somente pendência e não envia automaticamente ao Chão 70', function () {
  const inicio = app.indexOf('async function recvAdd');
  const fim = app.indexOf('function renderRecv', inicio);
  const fluxo = app.slice(inicio, fim);
  assert.match(fluxo, /STAGE\.unshift/);
  assert.equal(fluxo.includes('f70Entrada'), false);
  assert.equal(app.includes('recvBackfill70'), false);
});

test('bipagem da vaga resolve pendência local antes de consultar a nuvem', function () {
  const inicio = app.indexOf('async function bobFetch');
  const fim = app.indexOf('window.bobFetch=bobFetch', inicio);
  const busca = app.slice(inicio, fim);
  assert.match(busca, /STAGE\.find/);
  assert.match(busca, /Promise\.all/);
  assert.match(busca, /3500/);
});

test('exclusão direta de estoque fica restrita ao admin sem bloquear a saída operacional', function () {
  assert.match(app, /strictAdm=\(typeof isStrictAdmin==='function'&&isStrictAdmin\(\)\)/);
  assert.match(app, /Somente admin pode excluir pendência/);
  assert.match(app, /floorRemoveEt\(achouPr,et,true\)/);
  assert.match(app, /f70RemoveEt\(achouPr,et,true\)/);
  assert.match(app, /function floorRemoveEt\(pr,et,saidaOperacional\)\{if\(!saidaOperacional&&!isStrictAdmin\(\)\)/);
  assert.match(app, /function f70RemoveEt\(pr,et,saidaOperacional\)\{if\(!saidaOperacional&&!isStrictAdmin\(\)\)/);
  assert.match(app, /window\.recicRemoveCode=function\(pr\)\{if\(!\(typeof isStrictAdmin/);
});
